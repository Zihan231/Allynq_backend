import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('Pagination (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /users with pagination parameters returns paginated payload', async () => {
    const res = await request(app.getHttpServer())
      .get('/users?page=1&limit=25')
      .expect(200);

    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(25);

    const meta = res.body.meta;
    expect(meta.page).toBe(1);
    expect(meta.limit).toBe(25);
    expect(meta.total).toBeGreaterThanOrEqual(700);
    expect(meta.totalPages).toBe(Math.ceil(meta.total / 25));
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPreviousPage).toBe(false);
  });

  it('GET /users page 2 has correct previous/next pagination flags', async () => {
    const res = await request(app.getHttpServer())
      .get('/users?page=2&limit=25')
      .expect(200);

    expect(res.body.data.length).toBe(25);
    expect(res.body.meta.page).toBe(2);
    expect(res.body.meta.hasPreviousPage).toBe(true);
  });

  it('GET /communities with pagination returns paginated communities', async () => {
    const res = await request(app.getHttpServer())
      .get('/communities?page=1&limit=10')
      .expect(200);

    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.data.length).toBe(10);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(10);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(25);
    expect(res.body.meta.hasNextPage).toBe(true);
  });

  it('GET /clubs with pagination returns paginated clubs', async () => {
    const res = await request(app.getHttpServer())
      .get('/clubs?page=1&limit=20')
      .expect(200);

    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.data.length).toBe(20);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(20);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(55);
  });

  it('GET /communities/:id/members with pagination returns paginated community members', async () => {
    const commRes = await request(app.getHttpServer()).get('/communities?page=1&limit=1');
    const commId = commRes.body.data[0].id;

    const res = await request(app.getHttpServer())
      .get(`/communities/${commId}/members?page=1&limit=15`)
      .expect(200);

    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(15);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(15);
  });
});
