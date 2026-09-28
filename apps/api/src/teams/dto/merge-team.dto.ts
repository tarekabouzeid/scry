import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class MergeTeamDto {
  @ApiProperty({ description: "The team that absorbs this one." })
  @IsUUID()
  intoTeamId!: string;
}
