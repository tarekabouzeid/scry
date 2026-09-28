import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { Type } from "class-transformer";

export const BRIEF_PERIODS = [30, 90, 180, 365, 0] as const;

export class BriefQueryDto {
  /** Days to look back; 0 (or omitted with all=true) for all time. Default 90. */
  @IsOptional()
  @Type(() => Number)
  @IsIn(BRIEF_PERIODS)
  days?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  unit?: string;
}
