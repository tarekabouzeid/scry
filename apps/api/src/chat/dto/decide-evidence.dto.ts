import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID, ValidateIf } from "class-validator";
import { edgeTypeEnum } from "@scry/db";

export class DecideEvidenceDto {
  @ApiProperty()
  @IsUUID()
  initiativeId!: string;

  @ApiProperty({ enum: ["linked", "dismissed", null], nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsIn(["linked", "dismissed"])
  decision!: "linked" | "dismissed" | null;

  @ApiPropertyOptional({ enum: edgeTypeEnum.enumValues })
  @IsOptional()
  @IsIn(edgeTypeEnum.enumValues)
  edgeType?: (typeof edgeTypeEnum.enumValues)[number];
}
