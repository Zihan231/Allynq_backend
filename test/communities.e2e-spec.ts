import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('Communities (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /communities returns list of communities with stats', async () => {
    const res = await request(app.getHttpServer())
      .get('/communities')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const dhakaElite = res.body.find((c: any) => c.name === 'Dhaka Elite Community');
    expect(dhakaElite).toBeDefined();
    expect(dhakaElite.memberClubIds.length).toBeGreaterThan(0);
    expect(dhakaElite.memberCount).toBeGreaterThan(0);
  });

  it('GET /communities/:id returns community with clubs and members', async () => {
    const listRes = await request(app.getHttpServer()).get('/communities');
    const firstComm = listRes.body[0];

    const res = await request(app.getHttpServer())
      .get(`/communities/${firstComm.id}`)
      .expect(200);

    expect(res.body.id).toBe(firstComm.id);
    expect(res.body.name).toBe(firstComm.name);
    expect(Array.isArray(res.body.clubs)).toBe(true);
    expect(Array.isArray(res.body.members)).toBe(true);
  });

  it('GET /communities/:id/members returns members list', async () => {
    const listRes = await request(app.getHttpServer()).get('/communities');
    const firstComm = listRes.body[0];

    const res = await request(app.getHttpServer())
      .get(`/communities/${firstComm.id}/members`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('profileId');
    expect(res.body[0]).toHaveProperty('communityRole');
  });
});
