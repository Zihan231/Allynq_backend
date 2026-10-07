import { Controller, Get } from '@nestjs/common';
import { AdminPhaseSixService } from './admin-phase-six.service.js';

/** Public, read-only platform configuration used by the storefront and season banner. */
@Controller()
export class PlatformPublicController {
  constructor(private readonly phaseSix: AdminPhaseSixService) {}

  @Get('store/items')
  storeItems() {
    return this.phaseSix.storeCatalog(false);
  }

  @Get('seasons/current')
  currentSeason() {
    return this.phaseSix.currentSeason();
  }
}
