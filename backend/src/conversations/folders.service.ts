import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Folder } from '../db/entities/folder.entity';
import { ConversationEventsService } from './conversation-events.service';

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
    private readonly events: ConversationEventsService,
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
    const dto = this.toDto(await this.folders.save(f));
    this.events.emitUser({
      userId,
      type: 'folder.upsert',
      payload: { folder: dto },
    });
    return dto;
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
    const dto = this.toDto(await this.folders.save(existing));
    this.events.emitUser({
      userId,
      type: 'folder.upsert',
      payload: { folder: dto },
    });
    return dto;
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.folders.findOne({ where: { id } });
    if (!existing) return;
    if (existing.userId !== userId) throw new ForbiddenException();
    await this.folders.remove(existing);
    this.events.emitUser({
      userId,
      type: 'folder.deleted',
      payload: { id },
    });
  }
}
