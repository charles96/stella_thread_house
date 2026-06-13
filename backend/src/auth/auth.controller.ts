import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { InvitationService } from '../admin/invitation.service';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: false,
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationService,
  ) {}

  @Public()
  @Get('setup-status')
  setupStatus() {
    return this.auth.getSetupStatus();
  }

  // 초대 메일 링크에서 ?token=... 으로 들어왔을 때 토큰의 invited 이메일을 조회.
  // 가입 폼의 이메일 필드 자동 채움/락 용. pending 토큰만 노출.
  @Public()
  @Get('invitation/:token')
  async getInvitation(@Param('token') token: string) {
    const inv = await this.invitations.findPendingByToken(token);
    if (!inv) {
      throw new NotFoundException('Invalid invitation token.');
    }
    return { email: inv.email };
  }

  @Public()
  @Post('register')
  async register(
    @Body() body: { email: string; password: string; token?: string },
    @Res() res: Response,
  ) {
    const user = await this.auth.register(body);
    const token = this.auth.signToken(user);
    res.cookie('stella_token', token, COOKIE_OPTS);
    res.json(user);
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Res() res: Response,
  ) {
    const user = await this.auth.loginEmail(body.email, body.password);
    const token = this.auth.signToken(user);
    res.cookie('stella_token', token, COOKIE_OPTS);
    res.json(user);
  }

  @Post('change-password')
  @UseGuards(AuthGuard('jwt'))
  async changePassword(
    @Req() req: Request,
    @Body() body: { currentPassword?: string; newPassword: string },
  ) {
    const userId = (req.user as { sub: string }).sub;
    return this.auth.changePassword(
      userId,
      body.currentPassword ?? '',
      body.newPassword,
    );
  }

  @Post('profile')
  @UseGuards(AuthGuard('jwt'))
  async updateProfile(
    @Req() req: Request,
    @Body() body: { name?: string },
  ) {
    const userId = (req.user as { sub: string }).sub;
    return this.auth.updateName(userId, body.name ?? '');
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sub = (req.user as { sub: string }).sub;
    const user = await this.auth.getById(sub);
    if (!user) {
      // JWT 는 유효하지만 DB 에서 사라진 user — stale 쿠키. 쿠키 비우고 401.
      res.clearCookie('stella_token', { path: '/' });
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
    return user;
  }

  @Get('settings')
  @UseGuards(AuthGuard('jwt'))
  async getSettings(@Req() req: Request) {
    const userId = (req.user as { sub: string }).sub;
    return this.auth.getUserSettings(userId);
  }

  @Patch('settings')
  @UseGuards(AuthGuard('jwt'))
  async updateSettings(
    @Req() req: Request,
    @Body() body: { tavilyTopRead?: number; hashtagThreshold?: number },
  ) {
    const userId = (req.user as { sub: string }).sub;
    return this.auth.updateUserSettings(userId, body);
  }

  @Public()
  @Get('logout')
  logout(@Res() res: Response) {
    res.clearCookie('stella_token', { path: '/' });
    res.json({ ok: true });
  }
}
