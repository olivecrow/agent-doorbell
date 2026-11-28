export type ConfigureResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly cancelled: boolean;
      readonly reason: string;
    };

export interface ConfigurePrompts {
  choose<T extends string>(
    message: string,
    values: readonly T[],
    current: T,
  ): Promise<T>;
  search<T extends string>(
    message: string,
    choices: readonly { value: T; name: string }[],
    current: T | undefined,
  ): Promise<T>;
  confirm(message: string, current: boolean): Promise<boolean>;
  text(
    message: string,
    current: string,
    validate?: (value: string) => boolean | string,
  ): Promise<string>;
  secret(message: string): Promise<string>;
}

export async function createConfigurePrompts(
  signal: AbortSignal,
): Promise<ConfigurePrompts> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive configuration requires a terminal.");
  }
  const { confirm, input, password, search, select } =
    await import("@inquirer/prompts");
  signal.throwIfAborted();
  const context = { signal, clearPromptOnDone: true };

  return {
    choose: <T extends string>(
      message: string,
      values: readonly T[],
      current: T,
    ) =>
      select<T>(
        {
          message,
          choices: values.map((value) => ({ name: value, value })),
          default: current,
        },
        context,
      ),
    search: (message, choices, current) =>
      search({
        message,
        ...(current === undefined ? {} : { default: current }),
        source: (term) => {
          const query = term?.trim().toLowerCase();
          return query ? choices.filter(({ name }) => name.toLowerCase().includes(query)) : choices;
        },
      }, context),
    confirm: (message, current) =>
      confirm({ message, default: current }, context),
    text: (message, current, validate) =>
      input(
        { message, default: current, ...(validate ? { validate } : {}) },
        context,
      ),
    secret: (message) =>
      password(
        {
          message,
          mask: false,
          toggleMask: false,
          validate: (value) =>
            (value.trim().length > 0 && !/\s/.test(value.trim())) ||
            "Enter an API key without whitespace.",
        },
        context,
      ),
  };
}

export function configurationFailure(
  error: unknown,
  signal: AbortSignal,
): ConfigureResult {
  const cancelled =
    signal.aborted ||
    (error instanceof Error &&
      (error.name === "ExitPromptError" || error.name === "AbortPromptError"));
  return {
    ok: false,
    cancelled,
    reason: cancelled
      ? "Configuration cancelled."
      : "Could not complete configuration. Use an interactive terminal or speech options.",
  };
}
