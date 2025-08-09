import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
export const getEnv = (key, defaultValue) => {
    return process.env[key] || defaultValue || "";
};
export const getNumberEnv = (key, defaultValue) => {
    const value = process.env[key];
    return value ? Number(value) : defaultValue ?? 0;
};
export const getBooleanEnv = (key, defaultValue) => {
    const value = process.env[key];
    return value ? value === "true" : defaultValue ?? false;
};
export const getArrayEnv = (key, separator = ",") => {
    const value = process.env[key];
    return value ? value.split(separator) : [];
};
//# sourceMappingURL=index.js.map