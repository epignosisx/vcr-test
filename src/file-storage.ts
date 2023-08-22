import { readFile, writeFile, access, constants, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { HttpInteraction, ICassetteStorage } from './types';

const INVALID_FILENAME_CHARS: Set<string> = new Set<string>(['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>', '.', ',', ';', '=', ' ']);

export class FileStorage implements ICassetteStorage {

  constructor(private readonly directory: string) { }

  public async load(name: string): Promise<HttpInteraction[] | undefined> {
    try {
      var validName = this.replaceInvalidChars(name);
      var data = await readFile(join(this.directory, validName) + ".yaml", 'utf8');
      return yamlParse(data);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }
  public async save(name: string, interactions: HttpInteraction[]): Promise<void> {
    const validName = this.replaceInvalidChars(name);
    await access(this.directory, constants.F_OK).catch(async () => {
      await mkdir(this.directory, { recursive: true });
    });
    return writeFile(join(this.directory, validName) + ".yaml", yamlStringify(interactions), 'utf8');
  }

  private replaceInvalidChars(name: string): string {
    const newName = [];
    for (const ch of name) {
      newName.push(INVALID_FILENAME_CHARS.has(ch) ? "_" : ch);
    }
    return newName.join('');
  }
}
