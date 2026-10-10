import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Response, Request } from 'express';
import { signSession } from './common';
import { DomainService } from './domain.service';

@Controller('auth')
export class AuthController {
  constructor(private domain: DomainService) {}

  private async actor(req: Request) {
    return this.domain.userFromToken(req.cookies?.propia_session);
  }

  private cookie(res: Response, userId: string) {
    res.cookie('propia_session', signSession(userId), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 86400000,
    });
  }

  @Post('signup')
  signup(@Body() b: { email: string; password: string; terms: boolean; privacy: boolean }) {
    return this.domain.signup(b.email, b.password, b.terms, b.privacy);
  }

  @Post('confirm')
  async confirm(@Body() b: { email: string; code: string }, @Res({ passthrough: true }) res: Response) {
    const user = await this.domain.confirm(b.email, b.code);
    this.cookie(res, user.id);
    return user;
  }

  @Post('login')
  async login(@Body() b: { email: string; password: string }, @Res({ passthrough: true }) res: Response) {
    const user = await this.domain.login(b.email, b.password);
    this.cookie(res, user.id);
    return this.domain.me(user);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('propia_session', { path: '/' });
    return { ok: true };
  }

  @Post('forgot')
  forgot(@Body() b: { email: string }) {
    return this.domain.forgot(b.email);
  }

  @Post('reset')
  reset(@Body() b: { email: string; code: string; password: string }) {
    return this.domain.reset(b.email, b.code, b.password);
  }

  @Get('me')
  async me(@Req() req: Request) {
    const user = this.domain.require(await this.actor(req));
    return this.domain.me(user);
  }
}
