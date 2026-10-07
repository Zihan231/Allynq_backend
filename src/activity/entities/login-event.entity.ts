import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** A sign-in attempt, successful or not. */
@Entity('login_events')
export class LoginEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'boolean' })
  success!: boolean;

  /** wrong_password, unknown_email, banned, suspended, deleted. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  failureReason!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent!: string | null;

  /** HMAC of the client-generated x-device-id; the raw id is never retained. */
  @Column({ type: 'char', length: 64, nullable: true })
  deviceHash!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  deviceHint!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
