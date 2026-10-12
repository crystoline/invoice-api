import { Global, Module } from '@nestjs/common';
import { BusinessAccessService } from './business-access.service';

/** Makes BusinessAccessService injectable everywhere (guard + services). */
@Global()
@Module({
  providers: [BusinessAccessService],
  exports: [BusinessAccessService],
})
export class AuthzModule {}
