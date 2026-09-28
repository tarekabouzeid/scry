import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsUUID } from "class-validator";

// Admin-only — correcting a user's team assignment or role.
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional({ enum: ["member", "admin"] })
  @IsOptional()
  @IsIn(["member", "admin"])
  role?: "member" | "admin";

  @ApiPropertyOptional({ description: "Runs their team (only for someone in a team)." })
  @IsOptional()
  @IsBoolean()
  teamAdmin?: boolean;
}
