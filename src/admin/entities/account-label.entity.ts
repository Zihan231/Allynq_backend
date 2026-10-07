import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('account_labels')
@Index('account_labels_user_label_uq', ['userId', 'label'], { unique: true })
export class AccountLabel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 48 })
  label!: string;

  @Column({ type: 'varchar', length: 7, default: '#64748b' })
  color!: string;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
