import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The cosmetics store becomes a real product: the app's built-in catalogue is listed
 * in store_items (priced by rarity: common free, rare 200, epic 500, legendary 1000,
 * mythic 2000 tk), so purchases are charged and checked on the server. Items staff
 * already configured (same SKU) are left as they are.
 */
export class SeedStoreCatalog1792800000000 implements MigrationInterface {
  name = 'SeedStoreCatalog1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "store_items" ("sku", "name", "description", "category", "priceTk", "sortOrder", "metadata")
      VALUES
        ('badge-rookie', 'Rookie Initiate', 'Standard cybernetic crest forged upon stepping onto the competitive pitch.', 'badge', 0, 0, '{"rarity":"common"}'::jsonb),
        ('badge-clutch-finisher', 'Clutch Finisher', 'Bioluminescent laser crosshair awarded for ice-cold composure and stoppage-time winners.', 'badge', 200, 10, '{"rarity":"rare"}'::jsonb),
        ('badge-veteran', 'Battle-Hardened Veteran', 'Radiant amber crest honoring hundreds of hard-fought community tournaments and fixtures.', 'badge', 500, 20, '{"rarity":"epic"}'::jsonb),
        ('badge-shadow-striker', 'Shadow Striker', 'Nocturnal amethyst dagger crest awarded to players who strike from blind angles.', 'badge', 500, 30, '{"rarity":"epic"}'::jsonb),
        ('badge-champion', 'Grand Champion', '24K molten gold laurel crown with radiant ambient rays, reserved for tournament victors.', 'badge', 1000, 40, '{"rarity":"legendary"}'::jsonb),
        ('badge-dragon-slayer', 'Dragon Slayer', 'Blazing crimson wyrm emblem forged in high-stakes championship finals.', 'badge', 1000, 50, '{"rarity":"legendary"}'::jsonb),
        ('badge-legend', 'Mythic Sovereign', 'Chromatic celestial dragon emblem with pulsating prismatic aurora and shifting starlight.', 'badge', 2000, 60, '{"rarity":"mythic"}'::jsonb),
        ('title-rising-star', 'Rising Star', 'Crisp electric neon title illuminating your debut season.', 'title', 0, 70, '{"rarity":"common"}'::jsonb),
        ('title-playmaker', 'The Maestro', 'Glowing pitch trajectory title celebrating visionary midfield mastery and pinpoint assists.', 'title', 200, 80, '{"rarity":"rare"}'::jsonb),
        ('title-goal-machine', 'GOAL MACHINE', 'Blazing crimson inferno typeface radiating intense heat and matchday lethality.', 'title', 500, 90, '{"rarity":"epic"}'::jsonb),
        ('title-cyber-demon', '⚡ CYBER DEMON ⚡', 'Pulsating neon violet title flashing with cybernetic static discharge.', 'title', 500, 100, '{"rarity":"epic"}'::jsonb),
        ('title-unstoppable', 'UNSTOPPABLE JUGGERNAUT', 'Solid 24K gold metallic text sweep with hyper-luminous reflections and golden sparks.', 'title', 1000, 110, '{"rarity":"legendary"}'::jsonb),
        ('title-apex-predator', '★ APEX PREDATOR ★', 'Blood-ruby and gold gilded title marking dominance over every rival in the lobby.', 'title', 1000, 120, '{"rarity":"legendary"}'::jsonb),
        ('title-goat', '⚡ THE IMMORTAL GOAT ⚡', 'Animated prismatic chroma title with celestial lightning and iridescent aura.', 'title', 2000, 130, '{"rarity":"mythic"}'::jsonb),
        ('frame-classic-ring', 'Cyber Aegis Ring', 'Precision-milled aerospace alloy ring with tactical cyan indicator notches.', 'frame', 0, 140, '{"rarity":"common"}'::jsonb),
        ('frame-emerald-edge', 'Emerald Overdrive', 'Pulsating neon bio-circuit ring radiating green particle energy and micro-circuits.', 'frame', 200, 150, '{"rarity":"rare"}'::jsonb),
        ('frame-cyber-glitch', 'Cyberpunk Matrix Glitch', 'Dual electric violet and cyan holographic frame with animated neon node brackets.', 'frame', 500, 160, '{"rarity":"epic"}'::jsonb),
        ('frame-inferno', 'Infernal Dragon Blazecore', 'Swirling ruby flame halo with animated floating ember particles and molten rim.', 'frame', 500, 170, '{"rarity":"epic"}'::jsonb),
        ('frame-royal-gold', 'Crown of Kings', 'Dual 24K gold filigree rings with diamond-studded bezels and radiant rotating aura.', 'frame', 1000, 180, '{"rarity":"legendary"}'::jsonb),
        ('frame-solar-phoenix', 'Solar Phoenix Radiant Halo', 'Gilded solar crown with rotating amber rays and pulsating solar flare core.', 'frame', 1000, 190, '{"rarity":"legendary"}'::jsonb),
        ('frame-void-singularity', 'Celestial Void Singularity', 'Dual counter-rotating cosmic vortex rings with orbiting prismatic stardust motes.', 'frame', 2000, 200, '{"rarity":"mythic"}'::jsonb),
        ('theme-ocean-blue', 'Deep Cyber Abyss', 'Deep oceanic cyber atmosphere with dual neon sapphire flares and atmospheric depth.', 'theme', 200, 210, '{"rarity":"rare"}'::jsonb),
        ('theme-emerald', 'Emerald Stadium Floodlight', 'Lush stadium pitch glow with emerald laser ambient light and tactical pitch lines.', 'theme', 200, 220, '{"rarity":"rare"}'::jsonb),
        ('theme-frostbite', 'Glacial Cryo-Frost', 'Crisp polar ice-crystal diamond aura with frosted glass and cyan cold front.', 'theme', 500, 230, '{"rarity":"epic"}'::jsonb),
        ('theme-crimson', 'Crimson Blood Moon', 'Dramatic ruby flare background with smoky crimson nebula and fiery atmospheric glow.', 'theme', 500, 240, '{"rarity":"epic"}'::jsonb),
        ('theme-allynq-gold', 'ALLYNQ Sovereign Solar Gold', 'Signature ALLYNQ golden solar flares, honeycomb carbon weave, and warm radiance.', 'theme', 1000, 250, '{"rarity":"legendary"}'::jsonb),
        ('theme-cyberpunk-night', 'Cyberpunk 2077 Night City', 'High-voltage hot pink and electric cyan cyber skyline with glowing laser grids.', 'theme', 1000, 260, '{"rarity":"legendary"}'::jsonb),
        ('theme-celestial-nebula', 'Cosmic Hyper-Nebula', 'Ultra-deep space nebula with shifting violet-cyan auroras and animated starlight.', 'theme', 2000, 270, '{"rarity":"mythic"}'::jsonb),
        ('theme-real-madrid', 'Real Madrid CF · Los Blancos', 'Royal White and 24K gold crest of the 15-time European Kings with Santiago Bernabéu broadcast arena aura.', 'theme', 2000, 280, '{"rarity":"mythic"}'::jsonb),
        ('theme-fc-barcelona', 'FC Barcelona · Blaugrana', 'Iconic Blaugrana deep blue and garnet stripes with Senyera golden rays and Spotify Camp Nou floodlights.', 'theme', 1000, 290, '{"rarity":"legendary"}'::jsonb),
        ('theme-bangladesh-tigers', 'Bangladesh · Bengal Tigers', 'Royal Bengal Tiger roaring crest with solar crimson red sun, deep pitch green, and Dhaka stadium pride.', 'theme', 2000, 300, '{"rarity":"mythic"}'::jsonb),
        ('theme-arsenal-fc', 'Arsenal FC · The Gunners', 'Iconic Gunners forward-facing brass cannon on London red-and-white armor with Emirates Stadium electricity.', 'theme', 1000, 310, '{"rarity":"legendary"}'::jsonb),
        ('theme-man-united', 'Manchester United · Red Devils', 'Old Trafford fiery red and black steel architecture with the legendary Red Devil trident crest.', 'theme', 1000, 320, '{"rarity":"legendary"}'::jsonb),
        ('theme-chelsea-fc', 'Chelsea FC · Pride of London', 'Royal Chelsea Blue with ceremonial golden rampant lion, Stamford Bridge lasers, and London rose badges.', 'theme', 500, 330, '{"rarity":"epic"}'::jsonb),
        ('theme-man-city', 'Manchester City · Cityzens', 'Etihad electric sky blue and navy holographic waves with the treble champion ship and rose crest.', 'theme', 1000, 340, '{"rarity":"legendary"}'::jsonb),
        ('theme-atletico-madrid', 'Atlético de Madrid · Colchoneros', 'Rojiblanco red-and-white battle stripes with the 7 stars of Ursa Major and Cívitas Metropolitano neon.', 'theme', 500, 350, '{"rarity":"epic"}'::jsonb),
        ('theme-psg', 'Paris Saint-Germain · Ici c''est Paris', 'Midnight navy blue and rouge stripe with the glowing Eiffel Tower silhouette and Fleur-de-lis of Saint-Germain.', 'theme', 500, 360, '{"rarity":"epic"}'::jsonb),
        ('theme-bayern-munchen', 'FC Bayern München · Stern des Südens', 'Crimson red with Bavarian blue-and-white diamond lozenge illumination and 5 championship gold stars.', 'theme', 1000, 370, '{"rarity":"legendary"}'::jsonb)
      ON CONFLICT ("sku") DO NOTHING`);
    // Store purchases in the wallet ledger.
    await queryRunner.query(`ALTER TABLE "wallet_transactions" ADD "storeItemId" uuid NULL REFERENCES "store_items"("id") ON DELETE SET NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet_transactions" DROP COLUMN "storeItemId"`);
    // Built-in items are left in place: users may own them.
  }
}
