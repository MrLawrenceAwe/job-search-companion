import { homedir } from "node:os";
import { join } from "node:path";

export const dataDirectory = (homePath = homedir()) =>
  join(homePath, "Library/Application Support/Job Search Companion");
