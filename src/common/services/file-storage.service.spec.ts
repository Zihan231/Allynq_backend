import { Test, TestingModule } from '@nestjs/testing';
import { FileStorageService } from './file-storage.service';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';

describe('FileStorageService', () => {
  let service: FileStorageService;
  const dummyBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FileStorageService],
    }).compile();

    service = module.get<FileStorageService>(FileStorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should save a base64 image and return public url', async () => {
    const url = await service.saveBase64Image(dummyBase64, 'users', 'dp');
    expect(url).toBeDefined();
    expect(url).toMatch(/^\/uploads\/users\/dp\/[a-f0-9-]+\.png$/);

    // Verify file exists on disk
    const diskPath = join(process.cwd(), url!);
    expect(existsSync(diskPath)).toBe(true);

    // Clean up
    const deleted = await service.deleteFile(url);
    expect(deleted).toBe(true);
    expect(existsSync(diskPath)).toBe(false);
  });

  it('should return input unchanged if already a URL or empty', async () => {
    expect(await service.saveBase64Image('https://example.com/avatar.jpg', 'users', 'dp')).toBe('https://example.com/avatar.jpg');
    expect(await service.saveBase64Image(null, 'users', 'dp')).toBeNull();
    expect(await service.saveBase64Image(undefined, 'users', 'dp')).toBeUndefined();
  });

  it('should ignore deleteFile for non-uploads URL or empty input', async () => {
    expect(await service.deleteFile(null)).toBe(false);
    expect(await service.deleteFile(undefined)).toBe(false);
    expect(await service.deleteFile('https://example.com/img.jpg')).toBe(false);
    expect(await service.deleteFile('data:image/png;base64,...')).toBe(false);
  });

  it('should prevent path traversal attempts', async () => {
    expect(await service.deleteFile('/uploads/../../package.json')).toBe(false);
  });
});
