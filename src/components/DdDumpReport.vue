<template>
    <UModal v-model:open="opened" title="Автоматический настройщик — результат" :dismissible="!busy" :close="!busy">
        <template #body>
            <p role="status">{{ status }}</p>
            <pre class="mt-3 whitespace-pre-wrap break-all text-xs max-h-96 overflow-auto">{{ report }}</pre>
        </template>
    </UModal>
</template>
<script setup lang="ts">
import { useDdDump } from "../composables/useDdDump";
const { opened, busy, status, report } = useDdDump();
</script>
