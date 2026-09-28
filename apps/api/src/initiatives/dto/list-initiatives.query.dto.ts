import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { initiativeStatusEnum, initiativeTierEnum } from "@scry/db";
import { INITIATIVE_SORTS, type InitiativeSort } from "@scry/shared";

/** Filters shared by the list and the counts. */
export class InitiativeFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional({ description: "Leave out this team's initiatives." })
  @IsOptional()
  @IsUUID()
  notTeamId?: string;

  @ApiPropertyOptional({ description: "true: leave out merged duplicates." })
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  unmerged?: boolean;

  @ApiPropertyOptional({ enum: initiativeStatusEnum.enumValues })
  @IsOptional()
  @IsIn(initiativeStatusEnum.enumValues)
  status?: (typeof initiativeStatusEnum.enumValues)[number];

  @ApiPropertyOptional({ enum: initiativeTierEnum.enumValues })
  @IsOptional()
  @IsIn(initiativeTierEnum.enumValues)
  tier?: (typeof initiativeTierEnum.enumValues)[number];

  @ApiPropertyOptional({
    description:
      "Case-insensitive match against title/summary (or a whole tag); every word must appear.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: "Only initiatives with this tag." })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tag?: string;

  @ApiPropertyOptional({
    description: "With `to`: only dated initiatives whose start–target span overlaps the window.",
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListInitiativesQueryDto extends InitiativeFiltersDto {
  @ApiPropertyOptional({ enum: INITIATIVE_SORTS, default: "updated" })
  @IsOptional()
  @IsIn(INITIATIVE_SORTS)
  sort?: InitiativeSort;

  @ApiPropertyOptional({
    enum: ["asc", "desc"],
    description: "Default: newest first for updated, A–Z / lifecycle / soonest for the rest.",
  })
  @IsOptional()
  @IsIn(["asc", "desc"])
  dir?: "asc" | "desc";

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: "`nextCursor` from the previous page." })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;
}

export class CountInitiativesQueryDto extends InitiativeFiltersDto {
  @ApiProperty({ enum: ["status", "team"] })
  @IsIn(["status", "team"])
  groupBy!: "status" | "team";
}

export class LookupInitiativesQueryDto {
  @ApiProperty({ description: "Comma-separated ids, at most 200." })
  @IsString()
  @MaxLength(200 * 37)
  ids!: string;
}
