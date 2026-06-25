declare module "dotenv" {
  export function config(options?: Record<string, unknown>): { parsed?: Record<string, string>; error?: Error };
}
