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

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 48 })
  label!: string;

  @Column({ type: 'varchar', length: 7, default: '#64748b' })
  color!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt!: Date;
}
