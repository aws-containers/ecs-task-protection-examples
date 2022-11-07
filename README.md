aws configure add-model \
   --service-model file://ecs-2014-11-13.normal.json \
   --service-name ecsCustom

ECS_GAMMA_ENDPOINT=https://madison.us-west-2.amazonaws.com
ECS_GAMMA_REGION=us-west-2
export ECS_GAMMA=(--endpoint $ECS_GAMMA_ENDPOINT --region $ECS_GAMMA_REGION ecsCustom)
export ECSG=($ECS_GAMMA[@])

aws $ECSG register-task-definition --cli-input-json file://queue-consumer.json

aws $ECSG create-service --cluster default --service-name queue-consumer --desired-count 2 --task-definition arn:aws:ecs:us-west-2:209640446841:task-definition/queue-consumer:1 --network-configuration "awsvpcConfiguration={subnets=[subnet-0b081bfbba1eb0da3],securityGroups=[ sg-058742c3846dd0438],assignPublicIp=ENABLED}"

aws $ECSG list-services

aws $ECSG describe-services --services arn:aws:ecs:us-west-2:209640446841:service/default/queue-consumer
