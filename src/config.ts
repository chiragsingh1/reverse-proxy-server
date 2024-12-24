import fs from "node:fs/promises";
import { parse } from "yaml";

async function parseYAMLConfig(filepath: string) {
    const configFileContent = await fs.readFile(filepath, "utf-8");
    const configParsed = parse(configFileContent);
    return JSON.stringify(configParsed);
}

async function validateConfig(config: string) {}
