import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhaseSixAdministration1792200000000 implements MigrationInterface {
  name = 'AddPhaseSixAdministration1792200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN "twoFactorSecretEncrypted" text`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN "twoFactorEnabledAt" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN "twoFactorLastCounter" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE login_events ADD COLUMN "deviceHash" char(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE login_events ADD COLUMN "deviceHint" varchar(128)`,
    );

    await queryRunner.query(`
      CREATE TABLE security_bans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind varchar(16) NOT NULL CONSTRAINT security_bans_kind_check CHECK (kind IN ('ip', 'device')),
        "valueHash" char(64) NOT NULL,
        "valueHint" varchar(128) NOT NULL,
        reason text NOT NULL,
        "createdById" uuid REFERENCES users(id) ON DELETE SET NULL,
        "expiresAt" timestamptz,
        "revokedAt" timestamptz,
        "revokedById" uuid REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX security_bans_lookup_idx ON security_bans (kind, "valueHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX security_bans_created_by_idx ON security_bans ("createdById")`,
    );
    await queryRunner.query(
      `CREATE INDEX security_bans_revoked_by_idx ON security_bans ("revokedById")`,
    );

    await queryRunner.query(`
      CREATE TABLE account_staff_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "authorId" uuid REFERENCES users(id) ON DELETE SET NULL,
        "authorName" varchar(255) NOT NULL,
        body text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX account_staff_notes_user_created_idx ON account_staff_notes ("userId", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX account_staff_notes_author_idx ON account_staff_notes ("authorId")`,
    );

    await queryRunner.query(`
      CREATE TABLE account_labels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label varchar(48) NOT NULL,
        color varchar(7) NOT NULL DEFAULT '#64748b' CONSTRAINT account_labels_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
        "createdById" uuid REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT account_labels_user_label_uq UNIQUE ("userId", label)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX account_labels_created_by_idx ON account_labels ("createdById")`,
    );

    await queryRunner.query(`
      CREATE TABLE notification_templates (
        code varchar(64) PRIMARY KEY,
        "titleTemplate" varchar(255) NOT NULL,
        "messageTemplate" text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        "updatedById" uuid REFERENCES users(id) ON DELETE SET NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX notification_templates_updated_by_idx ON notification_templates ("updatedById")`,
    );

    await queryRunner.query(`
      CREATE TABLE seasons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL,
        description text,
        "startsAt" timestamptz NOT NULL,
        "endsAt" timestamptz NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'draft' CONSTRAINT seasons_status_check CHECK (status IN ('draft', 'active', 'closed')),
        rules jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdById" uuid REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT seasons_dates_check CHECK ("endsAt" > "startsAt")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX seasons_one_active_idx ON seasons (status) WHERE status = 'active'`,
    );
    await queryRunner.query(
      `CREATE INDEX seasons_created_by_idx ON seasons ("createdById")`,
    );
    await queryRunner.query(
      `CREATE INDEX seasons_dates_idx ON seasons ("startsAt", "endsAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE store_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku varchar(64) NOT NULL UNIQUE,
        name varchar(120) NOT NULL,
        description text,
        category varchar(16) NOT NULL CONSTRAINT store_items_category_check CHECK (category IN ('badge', 'title', 'frame', 'theme')),
        "priceTk" integer NOT NULL CONSTRAINT store_items_price_check CHECK ("priceTk" >= 0),
        "assetUrl" text,
        active boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX store_items_catalog_idx ON store_items (active, "sortOrder", name)`,
    );

    await queryRunner.query(`
      CREATE TABLE platform_backups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status varchar(16) NOT NULL DEFAULT 'creating' CONSTRAINT platform_backups_status_check CHECK (status IN ('creating', 'ready', 'failed')),
        "fileName" varchar(255),
        "sizeBytes" bigint,
        "checksumSha256" char(64),
        failure text,
        "createdById" uuid REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX platform_backups_created_by_idx ON platform_backups ("createdById")`,
    );
    await queryRunner.query(
      `CREATE INDEX platform_backups_created_at_idx ON platform_backups ("createdAt" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE platform_backups`);
    await queryRunner.query(`DROP TABLE store_items`);
    await queryRunner.query(`DROP TABLE seasons`);
    await queryRunner.query(`DROP TABLE notification_templates`);
    await queryRunner.query(`DROP TABLE account_labels`);
    await queryRunner.query(`DROP TABLE account_staff_notes`);
    await queryRunner.query(`DROP TABLE security_bans`);
    await queryRunner.query(
      `ALTER TABLE login_events DROP COLUMN "deviceHint"`,
    );
    await queryRunner.query(
      `ALTER TABLE login_events DROP COLUMN "deviceHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN "twoFactorEnabledAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN "twoFactorLastCounter"`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN "twoFactorSecretEncrypted"`,
    );
  }
}
