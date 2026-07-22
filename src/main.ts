import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// Prisma models use BigInt ids; Spring serialized Long as a JSON number.
// Serialize BigInt as Number so the API stays contract-compatible.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

async function bootstrap() {
  // rawBody: true exposes req.rawBody so payment webhooks can verify signatures.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  // Match the Spring backend: every route lives under /api so the existing
  // frontend contract (http://host/api/...) stays byte-compatible.
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger (legacy exposed springdoc UI).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Invoicing API')
    .setDescription('NestJS port of the Spring invoicing backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('swagger-ui', app, SwaggerModule.createDocument(app, swaggerConfig));

  // Spring used @CrossOrigin(origins = "*"). Keep it permissive for now; tighten
  // to FRONTEND_URL before cutover (see migration doc §7).
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL') ?? true,
    credentials: true,
  });

  const port = config.get<number>('APP_PORT') ?? 8080;
  await app.listen(port);
}
void bootstrap();
