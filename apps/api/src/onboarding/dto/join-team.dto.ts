import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class JoinTeamDto {
  @ApiProperty()
  @IsUUID()
  teamId!: string;
}
