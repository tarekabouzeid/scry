import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { OPEN_OVERLAPS_MAX } from "../overlaps.service";

export class ListOverlapsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OPEN_OVERLAPS_MAX)
  limit?: number;

  /** Comma separated; checked by parseInitiativeIds. */
  @IsOptional()
  @IsString()
  initiativeIds?: string;
}
