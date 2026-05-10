import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Folder } from '../db/entities/folder.entity';

export type FolderKind = 'thread' | 'chat';

export type FolderDto = {
  id: string;
  userId: string;
  name: string;
  kind: FolderKind;
  expanded: boolean;
  createdAt: number;
};

@Injectable()
export class FoldersService {
  constructor(
    @InjectRepository(Folder)
    private readonly folders: Repository<Folder>,
  ) {}

  private toDto(f: Folder): FolderDto {
    return {
      id: f.id,
      userId: f.userId,
      name: f.name,
      kind: (f.kind ?? 'thread') as FolderKind,
      expanded: f.expanded,
      createdAt: f.createdAt.getTime(),
    };
  }

  async listForUser(userId: string): Promise<FolderDto[]> {
    const rows = await this.folders.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    userId: string,
    input: { id?: string; name: string; kind?: FolderKind; expanded?: boolean },
  ): Promise<FolderDto> {
    const f = this.folders.create({
      id: input.id,
      userId,
      name: input.name,
      kind: input.kind ?? 'thread',
      expanded: input.expanded ?? true,
    });
    return this.toDto(await this.folders.save(f));
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<{ name: string; expanded: boolean }>,
  ): Promise<FolderDto> {
    const existing = await this.folders.findOne({ where: { id } });
    if (!existing) throw new NotFoundException();
    if (existing.userId !== userId) throw new ForbiddenException();
    if (patch.name !== undefined) existing.name = patch.name;
    if (patch.expanded !== undefined) existing.expanded = patch.expanded;
    return this.toDto(await this.folders.save(existing));
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.folders.findOne({ where: { id } });
    if (!existing) return;
    if (existing.userId !== userId) throw new ForbiddenException();
    await this.folders.remove(existing);
  }
}
