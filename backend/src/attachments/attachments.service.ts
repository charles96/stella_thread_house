import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// 첨부 이미지 파일 시스템 저장 헬퍼.
// 경로: <UPLOAD_DIR>/<messageId>/<safeFileName>
@Injectable()
export class AttachmentsService {
  private readonly baseDir =
    process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');

  constructor() {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  // UUIDv7 형식만 허용 — 32자 hex + 4 dash. 디렉토리 traversal 방지.
  private validateMessageId(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('invalid messageId');
    }
  }

  // 파일명 안전화 — 경로 분리자/제어문자 제거, 길이 제한, 빈 이름 fallback.
  sanitizeFileName(name: string): string {
    const stripped = name
      .replace(/[\\/]/g, '_')
      .replace(/[\x00-\x1f]/g, '')
      .trim();
    const trimmed = stripped.length > 0 ? stripped : 'image';
    return trimmed.slice(0, 200);
  }

  private resolveDir(messageId: string): string {
    this.validateMessageId(messageId);
    return path.join(this.baseDir, messageId);
  }

  resolvePath(messageId: string, fileName: string): string {
    const dir = this.resolveDir(messageId);
    const safe = this.sanitizeFileName(fileName);
    const full = path.join(dir, safe);
    // 최종 경로가 baseDir 하위인지 재확인 (defense-in-depth).
    const rel = path.relative(this.baseDir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('invalid path');
    }
    return full;
  }

  // 같은 디렉토리에 같은 이름이 이미 있으면 (1), (2)... 접미사로 충돌 회피.
  private uniqueName(dir: string, fileName: string): string {
    const safe = this.sanitizeFileName(fileName);
    if (!fs.existsSync(path.join(dir, safe))) return safe;
    const ext = path.extname(safe);
    const base = safe.slice(0, safe.length - ext.length);
    for (let i = 1; i < 1000; i++) {
      const candidate = `${base} (${i})${ext}`;
      if (!fs.existsSync(path.join(dir, candidate))) return candidate;
    }
    return `${base}-${Date.now()}${ext}`;
  }

  // dataUrl 한 개를 디스크에 저장하고 최종 파일명을 반환.
  saveDataUrl(messageId: string, fileName: string, dataUrl: string): string {
    const m = /^data:([a-z0-9+\-./]+);base64,(.+)$/i.exec(dataUrl);
    if (!m) throw new BadRequestException('invalid data url');
    const buf = Buffer.from(m[2], 'base64');
    const dir = this.resolveDir(messageId);
    fs.mkdirSync(dir, { recursive: true });
    const finalName = this.uniqueName(dir, fileName);
    fs.writeFileSync(path.join(dir, finalName), buf);
    return finalName;
  }

  read(messageId: string, fileName: string): { stream: fs.ReadStream; size: number; mime: string } {
    const full = this.resolvePath(messageId, fileName);
    if (!fs.existsSync(full)) throw new NotFoundException();
    const st = fs.statSync(full);
    const ext = path.extname(full).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'image/jpeg';
    return { stream: fs.createReadStream(full), size: st.size, mime };
  }

  // 한 메시지의 모든 첨부 파일 디렉토리를 통째로 삭제. 메시지/대화 삭제 시 디스크 정리용.
  // 디렉토리가 없으면 no-op. 안전을 위해 baseDir 하위인지 재확인.
  deleteForMessage(messageId: string): void {
    try {
      this.validateMessageId(messageId);
    } catch {
      return; // 잘못된 messageId 형식이면 조용히 무시 (DB에 없는 ID 일 수도).
    }
    const dir = this.resolveDir(messageId);
    const rel = path.relative(this.baseDir, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') return;
    if (!fs.existsSync(dir)) return;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // base64 로 인코딩한 data URL 반환 — AI 호출 시 backend 가 image URL 을 base64 로 환원할 때 사용.
  readAsDataUrl(messageId: string, fileName: string): string | null {
    try {
      const full = this.resolvePath(messageId, fileName);
      if (!fs.existsSync(full)) return null;
      const buf = fs.readFileSync(full);
      const ext = path.extname(full).toLowerCase();
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.webp'
              ? 'image/webp'
              : 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }
}
