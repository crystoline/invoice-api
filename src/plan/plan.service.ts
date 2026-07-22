import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../payment/paystack.service';
import { ok, fail, ResponseObject } from '../common/dto/response-object';
import { SubRequestDto } from './dto/plan.dto';

@Injectable()
export class PlanService implements OnModuleInit {
  private readonly logger = new Logger(PlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
  ) {}

  /** Seed the 3 default plans on startup (replaces PlanService.initPlans @PostConstruct). */
  async onModuleInit(): Promise<void> {
    const count = await this.prisma.plans.count();
    if (count === 0) {
      await this.prisma.plans.createMany({
        data: [
          { name: 'Basic', description: 'Basic subscription plan', price: 10000, duration_in_days: 30 },
          { name: 'Standard', description: 'Standard subscription plan', price: 20000, duration_in_days: 60 },
          { name: 'Premium', description: 'Premium subscription plan', price: 30000, duration_in_days: 90 },
        ],
      });
      this.logger.log('Seeded default subscription plans.');
    }
  }

  async subscribe(dto: SubRequestDto): Promise<ResponseObject> {
    // These loads are outside the try in the legacy → 500 on bad id. Preserved.
    const plan = await this.prisma.plans.findUnique({ where: { id: BigInt(dto.PlanId ?? 0) } });
    if (!plan) throw new Error('Plan not found');
    const user = await this.prisma.users.findUnique({ where: { id: BigInt(dto.UserId ?? 0) } });
    if (!user) throw new Error('User not found');
    try {
      const paymentUrl = await this.paystack.initializePayment(user.email ?? '', plan.price ?? 0);
      if (!paymentUrl) throw new Error('Payment failed');
      const now = new Date();
      const end = new Date(now.getTime() + (plan.duration_in_days ?? 0) * 24 * 60 * 60 * 1000);
      await this.prisma.subscriptions.create({
        data: {
          user_id: user.id,
          plan_id: plan.id,
          start_date: now,
          end_date: end,
          // Legacy left isActive unset ("activate after payment confirmation"); the column is NOT NULL,
          // so we set false to satisfy the constraint while preserving the "not yet active" intent.
          is_active: false,
          is_cancelled: false,
        },
      });
      return ok('Use the payment url to complete your subscription.', paymentUrl);
    } catch (e) {
      return fail(`Subscription Failed ${(e as Error).message}`);
    }
  }
}
