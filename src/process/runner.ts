export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export type ProcessResult =
  | {
      ok: true;
      exitCode: 0;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      reason: string;
    };

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}
