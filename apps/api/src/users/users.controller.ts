import { Body, Controller, Get, Param, Patch, UseGuards, ParseUUIDPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { AdminGuard } from "../auth/guards/admin.guard";
import { UsersService } from "./users.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.users.list(user.role === "admin");
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return user.role === "admin" || user.id === id
      ? this.users.getOrThrow(id)
      : this.users.getDirectoryEntry(id);
  }

  @Patch(":id")
  @UseGuards(AdminGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(user, id, dto);
  }
}
