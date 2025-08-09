import dotenv from "dotenv";

import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export const getEnv = (key: string, defaultValue?: string): string => {
  return process.env[key] || defaultValue || "";
};

export const getNumberEnv = (key: string, defaultValue?: number): number => {
  const value = process.env[key];
  return value ? Number(value) : defaultValue ?? 0;
};

export const getBooleanEnv = (key: string, defaultValue?: boolean): boolean => {
  const value = process.env[key];
  return value ? value === "true" : defaultValue ?? false;
};
export const getArrayEnv = (key: string, separator = ","): string[] => {
  const value = process.env[key];
  return value ? value.split(separator) : [];
};
