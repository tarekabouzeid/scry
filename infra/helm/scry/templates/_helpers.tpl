{{- define "scry.fullname" -}}
{{ .Release.Name }}-scry
{{- end -}}

{{- define "scry.labels" -}}
app.kubernetes.io/name: scry
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "scry.secretName" -}}
{{- if .Values.existingSecret -}}
{{ .Values.existingSecret }}
{{- else -}}
{{ include "scry.fullname" . }}-secrets
{{- end -}}
{{- end -}}
