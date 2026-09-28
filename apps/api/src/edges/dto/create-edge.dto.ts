import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsUUID } from "class-validator";
import { edgeTypeEnum } from "@scry/db";

export class CreateEdgeDto {
  @ApiProperty()
  @IsUUID()
  fromInitiativeId!: string;

  @ApiProperty()
  @IsUUID()
  toInitiativeId!: string;

  @ApiProperty({ enum: edgeTypeEnum.enumValues })
  @IsIn(edgeTypeEnum.enumValues)
  type!: (typeof edgeTypeEnum.enumValues)[number];
}
