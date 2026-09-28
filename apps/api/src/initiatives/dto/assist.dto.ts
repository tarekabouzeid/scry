import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class AssistInitiativeDto {
  @ApiProperty({
    enum: ["draft", "improve"],
    description:
      "draft: fill the fields from a rough description. improve: suggest edits to what's written.",
  })
  @IsIn(["draft", "improve"])
  mode!: "draft" | "improve";

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}
