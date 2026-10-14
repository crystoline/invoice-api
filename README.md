<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

#### Migrations Steps

```bash
cd invoicing-api
npm run prisma:migrate:deploy   # applies 0_init → creates every table
npm run prisma:generate         # only needed if node_modules/.prisma is stale
npm run db:seed                 # optional, if you want the seed rows
npm run start:dev               # env is read at boot — a restart is mandatory

```

1. Edit schema.prisma
2. `npm run prisma:migrate:new -- <name>`
3. Review the generated migration.sql
4. `npm run prisma:migrate:deploy`
5. Commit the prisma/migrations/ folder

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Production deploy checklist (Render)

Go through this whenever a release adds a migration or touches billing. Render auto-deploys `master`,
so do steps 1–3 **before** pushing.

1. **Migrate the live database first.** The new code expects the new columns at boot, so run this from a
   machine whose `.env` `DATABASE_URL` points at production:

   ```bash
   npm run prisma:migrate:status   # lists the pending migrations
   npm run prisma:migrate:deploy   # applies them
   ```

   After `20261014000000_billing_jurisdiction`, open **Admin → Plans**. Existing plans became the Nigeria
   (NGN) plans, and each one was copied as "<name> (USD)" for everyone else using the old USD prices.
   Check those prices and names before customers see them. The public Pricing page shows these plans
   as they are.

   **Plan limits are enforced.** A business runs on its owner's plan. Owners without a subscription, which
   includes everyone who never subscribed, get the **Free** plan's limits. Those are invoices a month
   (across all their businesses), businesses owned, people per business (owner included), recurring
   invoices and online payments. Check the Free plans' limits before deploying, because they decide what
   existing users can still create. Nothing is deleted when a limit is hit: existing data stays, and
   only new invoices, businesses, invitations and recurring runs are refused.

2. **Environment variables** (Render → service → Environment):

   | Variable                | Value                                                                    |
   | ----------------------- | ------------------------------------------------------------------------ |
   | `PAYSTACK_SECRET_KEY`   | Paystack secret key (`sk_live_…`). Nigeria: NGN subscriptions.            |
   | `STRIPE_SECRET_KEY`     | Stripe secret key (`sk_live_…`). Everyone else: USD subscriptions.        |
   | `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_…`) of the Stripe webhook endpoint in step 3.      |
   | `FRONTEND_URL`          | `https://invoice.crysto.name.ng`. Checkout sends customers back here.     |

3. **Webhooks.** Subscriptions only activate and renew through these.
   - **Paystack** → Settings → API Keys & Webhooks → Webhook URL:
     `https://<api-host>/api/webhooks/paystack` (signed with the secret key; nothing else to copy).
   - **Stripe** → Developers → Webhooks → Add endpoint `https://<api-host>/api/webhooks/stripe` with the
     events `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
     `customer.subscription.updated` and `customer.subscription.deleted`. Copy its signing secret into
     `STRIPE_WEBHOOK_SECRET`.

4. **Ship the API and the frontend together**: push both repos to `master`.

5. **Smoke test.** Make one real payment per gateway: a Nigerian account through Paystack and a non-Nigerian
   one through Stripe. Check that **Settings → Subscription** shows the plan as active and the payment under
   Billing history, then cancel.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
