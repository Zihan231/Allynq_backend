import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RegisterDto } from './register.dto.js';

const errorsFor = async (phoneNumber?: string) => {
  const dto = plainToInstance(RegisterDto, { email: 'a@b.com', password: '123456', name: 'A', phoneNumber });
  return (await validate(dto)).filter((e) => e.property === 'phoneNumber');
};

describe('RegisterDto phone number', () => {
  it.each(['+8801712345678', '+8801312345678', '+919876543210', '+12015550123', '+447400123456'])(
    'accepts %s',
    async (phone) => expect(await errorsFor(phone)).toHaveLength(0),
  );

  it.each<[string | undefined, string]>([
    [undefined, 'missing'],
    ['', 'empty'],
    ['01712345678', 'no country code'],
    ['+8801212345678', 'BD number not starting 13–19'],
    ['+880171234567', 'BD number too short'],
    ['+88017123456789', 'BD number too long'],
    ['+91 98765 43210', 'spaces'],
  ])('rejects %s (%s)', async (phone) => expect(await errorsFor(phone)).not.toHaveLength(0));
});
