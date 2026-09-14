{{/* The chart's name, overridable, truncated to what a label allows. */}}
{{- define "isitdown.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "isitdown.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "isitdown.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "isitdown.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "isitdown.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: {{ .Values.edition | quote }}
{{- end -}}

{{- define "isitdown.selectorLabels" -}}
app.kubernetes.io/name: {{ include "isitdown.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
The image to run. An empty `image.tag` means the edition's floating tag, which
is how the published images are named: `ui-latest`, `light-latest`.
*/}}
{{- define "isitdown.image" -}}
{{- $tag := .Values.image.tag | default (printf "%s-%s" .Values.edition .Chart.AppVersion) -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{- define "isitdown.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "isitdown.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* The claim the data volume uses: one supplied by the operator, or this chart's own. */}}
{{- define "isitdown.claimName" -}}
{{- default (include "isitdown.fullname" .) .Values.persistence.existingClaim -}}
{{- end -}}

{{/* Refuses an edition this chart has no templates for, rather than rendering half a release. */}}
{{- define "isitdown.validateEdition" -}}
{{- if not (has .Values.edition (list "ui" "light")) -}}
{{- fail (printf "edition must be \"ui\" or \"light\", got %q" .Values.edition) -}}
{{- end -}}
{{- end -}}
