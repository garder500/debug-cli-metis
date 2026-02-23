import { file } from "bun";

export async function readJsonFile<T>(filename: string): Promise<T> {
  const f = file(filename);
  if (!(await f.exists())) {
    throw new Error(`File not found: ${filename}`);
  }
  return await f.json() as T;
}
