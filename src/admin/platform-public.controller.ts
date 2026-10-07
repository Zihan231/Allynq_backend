import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AdminPhaseSixService } from './admin-phase-six.service.js';

/** Public, read-only platform configuration used by the store and the season rankings. */
@Controller()
export class PlatformPublicController {
  constructor(private readonly phaseSix: AdminPhaseSixService) {}

  /**
   * Every staff-managed store item, hidden ones included: the app overlays them on its
   * built-in catalogue (an inactive item hides the built-in item with the same code).
   */
  @Get('store/items')
  storeItems() {
    return this.phaseSix.storeCatalog(true);
  }

  @Get('seasons/current')
  currentSeason() {
    return this.phaseSix.currentSeason();
  }

  @Get('seasons')
  seasons() {
    return this.phaseSix.listSeasons();
  }

  /** Final standings of a closed season (`?kind=player|club`). */
  @Get('seasons/:id/standings')
  standings(@Param('id', ParseUUIDPipe) id: string, @Query('kind') kind?: string) {
    return this.phaseSix.seasonStandings(id, kind === 'club' ? 'club' : 'player');
  }
}
