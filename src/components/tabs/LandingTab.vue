<template>
    <BaseTab tab-name="landing">
        <div class="content_wrapper flex flex-col overflow-y-auto">
            <DdProgrammer />
        </div>
    </BaseTab>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import BaseTab from "./BaseTab.vue";
import DdProgrammer from "../DdProgrammer.vue";
import GUI from "../../js/gui";

onMounted(() => GUI.content_ready());
</script>
