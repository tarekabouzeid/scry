import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  MinLength,
} from "class-validator";
import { initiativeStatusEnum, initiativeTierEnum } from "@scry/db";

export class CreateInitiativeDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  summary!: string;

  @ApiPropertyOptional({ enum: initiativeStatusEnum.enumValues })
  @IsOptional()
  @IsIn(initiativeStatusEnum.enumValues)
  status?: (typeof initiativeStatusEnum.enumValues)[number];

  @ApiPropertyOptional({ enum: initiativeTierEnum.enumValues })
  @IsOptional()
  @IsIn(initiativeTierEnum.enumValues)
  tier?: (typeof initiativeTierEnum.enumValues)[number];

  @ApiPropertyOptional({ description: "Defaults to the submitter's own team." })
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional({ description: "Defaults to the submitter." })
  @IsOptional()
  @IsUUID()
  contactPerson?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: "Optional convenience link — never a dependency." })
  @IsOptional()
  @IsUrl()
  externalLink?: string;

  @ApiPropertyOptional({ description: "Why it's on hold; kept only while the status is on_hold." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  holdReason?: string | null;
}
