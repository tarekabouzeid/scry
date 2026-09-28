import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class MergeInitiativeDto {
  @ApiProperty({ description: "The initiative that carries on; this one is folded into it." })
  @IsUUID()
  intoId!: string;
}
