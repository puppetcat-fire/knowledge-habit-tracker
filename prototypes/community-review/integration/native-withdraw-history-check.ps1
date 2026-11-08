$ErrorActionPreference='Stop'
$qaBase='http://127.0.0.1:3107'
$publisherLogin=Invoke-RestMethod "$qaBase/api/login" -Method Post -ContentType application/json -Body (@{name='原生共创验收读者';password='test-only-2026'}|ConvertTo-Json) -SessionVariable qaPublisherSession -NoProxy
$readerLogin=Invoke-RestMethod "$qaBase/api/login" -Method Post -ContentType application/json -Body (@{name='原生共创验收作者';password='test-only-2026'}|ConvertTo-Json) -SessionVariable qaReaderSession -NoProxy
$source=Invoke-RestMethod "$qaBase/api/action-state" -WebSession $qaPublisherSession -NoProxy
$origin=$source.state.data.nodes | Where-Object title -eq '私人验收：制作个人草图'
if(@($origin).Count -ne 1){throw 'Expected one fixture target'}
$targetUrl="$qaBase/api/review-target-sharing?nodeId=$([Uri]::EscapeDataString($origin.id))"
$plan=Invoke-RestMethod $targetUrl -WebSession $qaPublisherSession -NoProxy
if($plan.current.visibility -ne 'public'){throw 'Expected published fixture'}
$headers=@{'X-Action-Account'=$publisherLogin.user.id;'If-Match'='"'+$source.revision+'"';'If-Target-Match'=$plan.revision}
$body=@{nodeId=$origin.id;sourceVersion=$origin.version;action='withdraw';consent=$true}|ConvertTo-Json
$withdraw=Invoke-RestMethod "$qaBase/api/review-target-sharing" -Method Post -ContentType application/json -Body $body -Headers $headers -WebSession $qaPublisherSession -NoProxy
try{
 $history=Invoke-RestMethod "$qaBase/api/records" -WebSession $qaReaderSession -NoProxy
 $record=$history.records | Where-Object eventId -eq '8fcebab6-66e3-41ad-9d5b-2c41872e7d31'
 $ownerRecords=Invoke-RestMethod "$qaBase/api/records" -WebSession $qaPublisherSession -NoProxy
 $discovery=Invoke-RestMethod "$qaBase/api/review-visible-targets" -WebSession $qaReaderSession -NoProxy
 $proof=[ordered]@{eventId=$record.eventId;privateHistoryReadable=$record.visibility -eq 'private';historicalTargetOnly=$record.historicalTargetOnly;oldGoalRetained=$record.sourceSnapshot.nodeGoal -eq '制作只属于自己的草图，并写下一个修改理由。';publisherCannotReadPrivatePractice=@($ownerRecords.records|Where-Object eventId -eq $record.eventId).Count -eq 0;withdrawnNotDiscoverable=@($discovery.targets|Where-Object nodeId -eq $plan.current.id).Count -eq 0}
 if(!$proof.privateHistoryReadable -or !$proof.historicalTargetOnly -or !$proof.oldGoalRetained -or !$proof.publisherCannotReadPrivatePractice -or !$proof.withdrawnNotDiscoverable){throw 'History boundary proof failed'}
 $proof | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '../output/root-audit/native-withdraw-history-verification.json') -Encoding utf8
 $proof | ConvertTo-Json
}finally{
 $refresh=Invoke-RestMethod $targetUrl -WebSession $qaPublisherSession -NoProxy
 $headers['If-Target-Match']=$refresh.revision
 $body=@{nodeId=$origin.id;sourceVersion=$origin.version;action='publish';consent=$true}|ConvertTo-Json
 $null=Invoke-RestMethod "$qaBase/api/review-target-sharing" -Method Post -ContentType application/json -Body $body -Headers $headers -WebSession $qaPublisherSession -NoProxy
}
