import { z } from 'zod';

export const registrationSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    agentCode: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9-]+$/),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{9,15}$/),
  })
  .strict();
export type Registration = z.infer<typeof registrationSchema>;
