import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { ProcessRequest, ProcessResult, ProcessRunner } from "./runner.js";

const MAX_OUTPUT_LENGTH = 1000;
const CLEANUP_GRACE_MS = 1000;

export class NodeProcessRunner implements ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolve) => {
      let stdout = "";
      let stderr = "";

      function failure(
        reason: string,
        exitCode: number | null = null,
      ): ProcessResult {
        return {
          ok: false,
          exitCode,
          stdout,
          stderr,
          reason,
        };
      }

      if (
        !Number.isInteger(request.timeoutMs) ||
        request.timeoutMs < 1 ||
        request.timeoutMs > 2_147_483_647
      ) {
        resolve(failure("Invalid timeoutMs value"));
        return;
      }

      if (request.signal?.aborted) {
        resolve(failure("Process cancelled"));
        return;
      }

      let child: ChildProcessWithoutNullStreams;

      try {
        child = spawn(request.command, request.args, {
          shell: false,
          windowsHide: true,
          env: { ...process.env, ...request.env },
        });
      } catch {
        resolve(failure("Failed to start child process"));
        return;
      }

      let settled = false;
      let stopReason: string | undefined;
      let processError: string | undefined;
      let terminationFailure: string | undefined;

      let timer: ReturnType<typeof setTimeout> | undefined;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

      function finish(result: ProcessResult): void {
        if (settled) return;
        settled = true;

        clearTimeout(timer);
        clearTimeout(cleanupTimer);
        request.signal?.removeEventListener("abort", onAbort);

        resolve(result);
      }

      function requestTermination(signal: NodeJS.Signals): void {
        try {
          if (!child.kill(signal)) {
            terminationFailure = `Failed to send ${signal}`;
          }
        } catch {
          terminationFailure = `Termination request threw while sending ${signal}`;
        }
      }

      function releaseChildHandles(): void {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
      }

      function withTerminationFailure(reason: string): string {
        return terminationFailure === undefined
          ? reason
          : `${reason}; ${terminationFailure}`;
      }

      function requestStop(reason: string): void {
        if (settled || stopReason !== undefined) return;

        stopReason = reason;
        clearTimeout(timer);

        cleanupTimer = setTimeout(() => {
          if (settled) return;

          if (child.exitCode === null && child.signalCode === null) {
            requestTermination("SIGKILL");
          }

          releaseChildHandles();

          finish(
            failure(
              withTerminationFailure(
                `${reason}; cleanup was not confirmed within ` +
                  `${CLEANUP_GRACE_MS} ms`,
              ),
              child.exitCode,
            ),
          );
        }, CLEANUP_GRACE_MS);

        requestTermination("SIGTERM");
      }

      function onAbort(): void {
        requestStop("Process cancelled");
      }

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        const remaining = MAX_OUTPUT_LENGTH - stdout.length;

        if (remaining > 0) {
          stdout += chunk.slice(0, remaining);
        }
      });

      child.stderr.on("data", (chunk: string) => {
        const remaining = MAX_OUTPUT_LENGTH - stderr.length;

        if (remaining > 0) {
          stderr += chunk.slice(0, remaining);
        }
      });

      child.on("error", (error) => {
        if (settled) return;

        if (stopReason !== undefined) {
          terminationFailure ??= "Child process error during cleanup";
        } else {
          processError = error.message;
        }
      });

      child.on("close", (code, signal) => {
        if (stopReason !== undefined) {
          finish(failure(withTerminationFailure(stopReason), code));
          return;
        }

        if (processError !== undefined) {
          finish(failure(processError, code));
          return;
        }

        if (code === 0) {
          finish({
            ok: true,
            exitCode: 0,
            stdout,
            stderr,
          });
          return;
        }

        finish(
          failure(
            signal !== null
              ? `Process terminated by signal: ${signal}`
              : `Process exited with code: ${code}`,
            code,
          ),
        );
      });

      timer = setTimeout(() => {
        requestStop(`Process timed out after ${request.timeoutMs} ms`);
      }, request.timeoutMs);

      request.signal?.addEventListener("abort", onAbort, { once: true });

      if (request.signal?.aborted) {
        onAbort();
      }
    });
  }
}
