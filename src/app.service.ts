import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  constructor(private readonly dataSource: DataSource) {}

  getHello(): string {
    return 'Hello World!';
  }

  async checkHealth() {
    const startTime = Date.now();
    try {
      // Execute a lightweight query to wake up and keep PostgreSQL connection alive
      await this.dataSource.query('SELECT 1');
      const dbLatencyMs = Date.now() - startTime;

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: 'up',
          latency: `${dbLatencyMs}ms`,
        },
      };
    } catch (error: any) {
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: 'down',
          error: error?.message ?? 'Database query failed',
        },
      });
    }
  }
}
