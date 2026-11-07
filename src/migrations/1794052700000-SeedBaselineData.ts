import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The data a fresh database needs on top of the schema (Baseline):
 *  - the built-in cosmetics catalogue (badges, titles, frames, themes), priced by rarity: common free, rare 200, epic 500, legendary 1000,
 *    mythic 2000 tk. Rows that already exist (same SKU) are left as staff configured them;
 *  - the contract number counter (see transfers/contracts.ts).
 * App settings need no rows: the code falls back to its defaults (settings.service.ts).
 */
export class SeedBaselineData1794052700000 implements MigrationInterface {
  name = 'SeedBaselineData1794052700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`INSERT INTO contract_counters (id, value) VALUES (1, 0) ON DUPLICATE KEY UPDATE id = id`);
    await queryRunner.query(`
      INSERT INTO store_items (id, sku, name, description, category, priceTk, sortOrder, metadata)
      VALUES
        (UUID(), 'badge-rookie', 'Rookie Initiate', 'Standard cybernetic crest forged upon stepping onto the competitive pitch.', 'badge', 0, 0, '{"rarity":"common"}'),
        (UUID(), 'badge-clutch-finisher', 'Clutch Finisher', 'Bioluminescent laser crosshair awarded for ice-cold composure and stoppage-time winners.', 'badge', 200, 10, '{"rarity":"rare"}'),
        (UUID(), 'badge-veteran', 'Battle-Hardened Veteran', 'Radiant amber crest honoring hundreds of hard-fought community tournaments and fixtures.', 'badge', 500, 20, '{"rarity":"epic"}'),
        (UUID(), 'badge-shadow-striker', 'Shadow Striker', 'Nocturnal amethyst dagger crest awarded to players who strike from blind angles.', 'badge', 500, 30, '{"rarity":"epic"}'),
        (UUID(), 'badge-champion', 'Grand Champion', '24K molten gold laurel crown with radiant ambient rays, reserved for tournament victors.', 'badge', 1000, 40, '{"rarity":"legendary"}'),
        (UUID(), 'badge-dragon-slayer', 'Dragon Slayer', 'Blazing crimson wyrm emblem forged in high-stakes championship finals.', 'badge', 1000, 50, '{"rarity":"legendary"}'),
        (UUID(), 'badge-legend', 'Mythic Sovereign', 'Chromatic celestial dragon emblem with pulsating prismatic aurora and shifting starlight.', 'badge', 2000, 60, '{"rarity":"mythic"}'),
        (UUID(), 'title-rising-star', 'Rising Star', 'Crisp electric neon title illuminating your debut season.', 'title', 0, 70, '{"rarity":"common"}'),
        (UUID(), 'title-playmaker', 'The Maestro', 'Glowing pitch trajectory title celebrating visionary midfield mastery and pinpoint assists.', 'title', 200, 80, '{"rarity":"rare"}'),
        (UUID(), 'title-goal-machine', 'GOAL MACHINE', 'Blazing crimson inferno typeface radiating intense heat and matchday lethality.', 'title', 500, 90, '{"rarity":"epic"}'),
        (UUID(), 'title-cyber-demon', '⚡ CYBER DEMON ⚡', 'Pulsating neon violet title flashing with cybernetic static discharge.', 'title', 500, 100, '{"rarity":"epic"}'),
        (UUID(), 'title-unstoppable', 'UNSTOPPABLE JUGGERNAUT', 'Solid 24K gold metallic text sweep with hyper-luminous reflections and golden sparks.', 'title', 1000, 110, '{"rarity":"legendary"}'),
        (UUID(), 'title-apex-predator', '★ APEX PREDATOR ★', 'Blood-ruby and gold gilded title marking dominance over every rival in the lobby.', 'title', 1000, 120, '{"rarity":"legendary"}'),
        (UUID(), 'title-goat', '⚡ THE IMMORTAL GOAT ⚡', 'Animated prismatic chroma title with celestial lightning and iridescent aura.', 'title', 2000, 130, '{"rarity":"mythic"}'),
        (UUID(), 'frame-classic-ring', 'Cyber Aegis Ring', 'Precision-milled aerospace alloy ring with tactical cyan indicator notches.', 'frame', 0, 140, '{"rarity":"common"}'),
        (UUID(), 'frame-emerald-edge', 'Emerald Overdrive', 'Pulsating neon bio-circuit ring radiating green particle energy and micro-circuits.', 'frame', 200, 150, '{"rarity":"rare"}'),
        (UUID(), 'frame-cyber-glitch', 'Cyberpunk Matrix Glitch', 'Dual electric violet and cyan holographic frame with animated neon node brackets.', 'frame', 500, 160, '{"rarity":"epic"}'),
        (UUID(), 'frame-inferno', 'Infernal Dragon Blazecore', 'Swirling ruby flame halo with animated floating ember particles and molten rim.', 'frame', 500, 170, '{"rarity":"epic"}'),
        (UUID(), 'frame-royal-gold', 'Crown of Kings', 'Dual 24K gold filigree rings with diamond-studded bezels and radiant rotating aura.', 'frame', 1000, 180, '{"rarity":"legendary"}'),
        (UUID(), 'frame-solar-phoenix', 'Solar Phoenix Radiant Halo', 'Gilded solar crown with rotating amber rays and pulsating solar flare core.', 'frame', 1000, 190, '{"rarity":"legendary"}'),
        (UUID(), 'frame-void-singularity', 'Celestial Void Singularity', 'Dual counter-rotating cosmic vortex rings with orbiting prismatic stardust motes.', 'frame', 2000, 200, '{"rarity":"mythic"}'),
        (UUID(), 'theme-ocean-blue', 'Deep Cyber Abyss', 'Deep oceanic cyber atmosphere with dual neon sapphire flares and atmospheric depth.', 'theme', 200, 210, '{"rarity":"rare"}'),
        (UUID(), 'theme-emerald', 'Emerald Stadium Floodlight', 'Lush stadium pitch glow with emerald laser ambient light and tactical pitch lines.', 'theme', 200, 220, '{"rarity":"rare"}'),
        (UUID(), 'theme-frostbite', 'Glacial Cryo-Frost', 'Crisp polar ice-crystal diamond aura with frosted glass and cyan cold front.', 'theme', 500, 230, '{"rarity":"epic"}'),
        (UUID(), 'theme-crimson', 'Crimson Blood Moon', 'Dramatic ruby flare background with smoky crimson nebula and fiery atmospheric glow.', 'theme', 500, 240, '{"rarity":"epic"}'),
        (UUID(), 'theme-allynq-gold', 'ALLYNQ Sovereign Solar Gold', 'Signature ALLYNQ golden solar flares, honeycomb carbon weave, and warm radiance.', 'theme', 1000, 250, '{"rarity":"legendary"}'),
        (UUID(), 'theme-cyberpunk-night', 'Cyberpunk 2077 Night City', 'High-voltage hot pink and electric cyan cyber skyline with glowing laser grids.', 'theme', 1000, 260, '{"rarity":"legendary"}'),
        (UUID(), 'theme-celestial-nebula', 'Cosmic Hyper-Nebula', 'Ultra-deep space nebula with shifting violet-cyan auroras and animated starlight.', 'theme', 2000, 270, '{"rarity":"mythic"}'),
        (UUID(), 'theme-real-madrid', 'Real Madrid CF · Los Blancos', 'Royal White and 24K gold crest of the 15-time European Kings with Santiago Bernabéu broadcast arena aura.', 'theme', 2000, 280, '{"rarity":"mythic"}'),
        (UUID(), 'theme-fc-barcelona', 'FC Barcelona · Blaugrana', 'Iconic Blaugrana deep blue and garnet stripes with Senyera golden rays and Spotify Camp Nou floodlights.', 'theme', 1000, 290, '{"rarity":"legendary"}'),
        (UUID(), 'theme-bangladesh-tigers', 'Bangladesh · Bengal Tigers', 'Royal Bengal Tiger roaring crest with solar crimson red sun, deep pitch green, and Dhaka stadium pride.', 'theme', 2000, 300, '{"rarity":"mythic"}'),
        (UUID(), 'theme-arsenal-fc', 'Arsenal FC · The Gunners', 'Iconic Gunners forward-facing brass cannon on London red-and-white armor with Emirates Stadium electricity.', 'theme', 1000, 310, '{"rarity":"legendary"}'),
        (UUID(), 'theme-man-united', 'Manchester United · Red Devils', 'Old Trafford fiery red and black steel architecture with the legendary Red Devil trident crest.', 'theme', 1000, 320, '{"rarity":"legendary"}'),
        (UUID(), 'theme-chelsea-fc', 'Chelsea FC · Pride of London', 'Royal Chelsea Blue with ceremonial golden rampant lion, Stamford Bridge lasers, and London rose badges.', 'theme', 500, 330, '{"rarity":"epic"}'),
        (UUID(), 'theme-man-city', 'Manchester City · Cityzens', 'Etihad electric sky blue and navy holographic waves with the treble champion ship and rose crest.', 'theme', 1000, 340, '{"rarity":"legendary"}'),
        (UUID(), 'theme-atletico-madrid', 'Atlético de Madrid · Colchoneros', 'Rojiblanco red-and-white battle stripes with the 7 stars of Ursa Major and Cívitas Metropolitano neon.', 'theme', 500, 350, '{"rarity":"epic"}'),
        (UUID(), 'theme-psg', 'Paris Saint-Germain · Ici c''est Paris', 'Midnight navy blue and rouge stripe with the glowing Eiffel Tower silhouette and Fleur-de-lis of Saint-Germain.', 'theme', 500, 360, '{"rarity":"epic"}'),
        (UUID(), 'theme-bayern-munchen', 'FC Bayern München · Stern des Südens', 'Crimson red with Bavarian blue-and-white diamond lozenge illumination and 5 championship gold stars.', 'theme', 1000, 370, '{"rarity":"legendary"}')
      ON DUPLICATE KEY UPDATE sku = sku`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Built-in items only (creator designs have an owner); users may own some, so this is for a fresh database.
    await queryRunner.query(`DELETE FROM store_items WHERE creatorUserId IS NULL`);
    await queryRunner.query(`DELETE FROM contract_counters WHERE id = 1`);
  }
}
