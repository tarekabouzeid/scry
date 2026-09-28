import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";
import { subscriptionTargetEnum } from "@scry/db";

export class SubscribeDto {
  @ApiProperty({ enum: subscriptionTargetEnum.enumValues })
  @IsIn(subscriptionTargetEnum.enumValues)
  targetType!: (typeof subscriptionTargetEnum.enumValues)[number];

  @ApiProperty({ description: "Team id, initiative id, or tag text." })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  targetValue!: string;
}
