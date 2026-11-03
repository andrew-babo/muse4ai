import fs from "node:fs";
import path from "node:path";

// B11 — secrets encrypted with the OS (safeStorage = DPAPI on Windows). Never stored in SQLite or logs.

export interface Cipher {
  available(): boolean;
  encrypt(s: string): Buffer;
  decrypt(b: Buffer): string;
}

export class Vault {
  private data: Record<string, string> = {};
  constructor(private file: string, private cipher: Cipher) {
    try {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      this.data = {};
    }
  }

  get secure(): boolean {
    return this.cipher.available();
  }

  set(ref: string, value: string): void {
    const enc = this.cipher.available() ? "dpapi:" + this.cipher.encrypt(value).toString("base64") : "plain:" + Buffer.from(value, "utf8").toString("base64");
    this.data[ref] = enc;
    this.flush();
  }

  get(ref: string): string | null {
    const v = this.data[ref];
    if (!v) return null;
    if (v.startsWith("dpapi:")) return this.cipher.decrypt(Buffer.from(v.slice(6), "base64"));
    if (v.startsWith("plain:")) return Buffer.from(v.slice(6), "base64").toString("utf8");
    return null;
  }

  delete(ref: string): void {
    delete this.data[ref];
    this.flush();
  }

  values(): string[] {
    return Object.keys(this.data)
      .map((k) => this.get(k))
      .filter((v): v is string => !!v);
  }

  private flush(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
