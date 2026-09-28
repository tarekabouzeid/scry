import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { CreateInitiativeDto } from "./create-initiative.dto";

export class ImportInitiativesDto {
  @ApiProperty({ type: [CreateInitiativeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreateInitiativeDto)
  rows!: CreateInitiativeDto[];
}
